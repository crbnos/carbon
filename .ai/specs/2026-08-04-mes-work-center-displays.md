# MES Work Center Displays

> Status: in-progress
> Author: brad
> Date: 2026-08-04

## TLDR

Two full-screen, unattended "displays" per work center in the MES, designed to be
mounted on a TV or tablet at the machine and read from across the shop floor:

1. **Maintenance display** — a question/answer scoreboard about preventative
   maintenance at the work center: overdue, due today, due soon, down now,
   unplanned volume and cost, last completed and by whom.
2. **Work display** — what is being produced at the work center right now, plus
   what is queued next.

Both share one visual shell: the work center name in a full-width header band
that is **green or red** by a single derived state, over a dark scoreboard body.
Green means "this work center is fine". Red means "somebody needs to look at
this".

## Problem Statement

Carbon already has all the underlying data — `maintenanceDispatch`,
`maintenanceSchedule`, `productionEvent`, `jobOperation` — but every existing MES
surface is a *worker* surface: it assumes a person holding a device, signed in,
tapping through lists (`/x/maintenance`, `/x/operations`). There is nothing to
hang on the wall.

Shop floors run on ambient information. A supervisor walking the floor should be
able to tell, at 30 feet and without touching anything, that Mill 3 is down for
unplanned maintenance, or that the Brake is idle with four jobs queued. Today
that requires signing into the MES and applying a work-center filter.

## Proposed Solution

A new top-level `/display` route tree in the MES app, outside the `/x` sidebar
shell, rendering full-bleed pages with no chrome.

```
/display                                  → picker (choose work center + display)
/display/:workCenterId/maintenance        → maintenance display
/display/:workCenterId/work               → work summary display
```

Each display polls its own loader on an interval (`useInterval` + `useRevalidator`)
so an unattended browser stays current without websockets or manual refresh.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Route location | New top-level `display+` group, not under `x+` | The `x+` layout renders the sidebar, pin-in overlay, time-card warning and console pill. A wall display wants none of that. A sibling group reuses `userMiddleware` for auth/location without inheriting the chrome. |
| Data model | **No migration.** Read existing tables/views | Every field needed already exists. Adding tables for a read-only view would be pure cost. |
| Query client | Service role, scoped explicitly by `companyId` | `maintenanceSchedule` RLS requires `resources_view`, which shop-floor operators typically lack — under the user client the *Upcoming* column would silently render empty for exactly the audience this feature targets. Follows the existing `x+/operations.tsx` precedent. The work center is validated against the session's `companyId` before any other query runs. |
| State colours | Binary green/red only | The requirement is a signal readable at distance, not a dashboard. A third amber state halves the signal's value. "Due soon but not late" stays green. |
| Refresh | Poll + revalidate (30s maintenance, 15s work) | Simple, survives network blips and server restarts, no socket lifecycle to babysit on a browser that runs for months. Work display is faster because production events change minute to minute. |
| Auth | Normal MES session (`userMiddleware`) | Keeps company/location scoping and RLS honest. A display is just a logged-in browser left open; console mode already exists for shared devices. |

### Display state

Derived by pure functions in `app/utils/display.ts` so the rules are testable and
the components stay dumb.

**Maintenance display is red when any of:**

| Reason | Condition |
|--------|-----------|
| `unplanned-downtime` | An in-progress dispatch with `oeeImpact = 'Down'` |
| `planned-downtime` | An in-progress dispatch with `oeeImpact = 'Planned'` |
| `overdue-maintenance` | An open/assigned dispatch whose `plannedEndTime` (else `plannedStartTime`) is in the past |
| `overdue-schedule` | An active `maintenanceSchedule` whose `nextDueAt` is in the past |

Otherwise green.

**Work display is red when:**

| Reason | Condition |
|--------|-----------|
| `blocked` | Work center blocked by maintenance (`workCentersWithBlockingStatus.isBlocked`) |
| `idle` | No open `productionEvent` at the work center |

Otherwise green (at least one production event running). `blocked` outranks
`idle` so the display names the actual cause.

## Data Model Changes

None. Reads only:

- `workCentersWithBlockingStatus` — name, `isBlocked`, blocking dispatch
- `maintenanceDispatch` — scheduled / in-progress / completed dispatches
- `maintenanceSchedule` — `nextDueAt`, `frequency` for the *Upcoming* column
- `maintenanceDispatchEvent` — who is currently wrenching on it
- `productionEvent` — open events = active work, joined to `jobOperation` → `job` → `item`
- `get_job_operations_by_work_center` RPC — the queue

## API / Service Changes

New `apps/mes/app/services/display.service.ts`:

- `getDisplayWorkCenter(client, { workCenterId, companyId })` — validates tenancy, returns name + blocking status
- `getWorkCentersForDisplayPicker(client, { companyId, locationId })`
- `getMaintenanceDisplayData(client, { workCenterId, companyId, completedSince })`
- `getWorkDisplayData(client, { workCenterId, companyId, locationId })`

New `apps/mes/app/utils/display.ts` — pure state derivation + formatting helpers,
covered by `display.test.ts`.

## UI Changes

New `apps/mes/app/components/Display/`:

- `DisplayFrame` — the shared shell: work center name, display title, live clock,
  status banner, green/red background, dense-grid body.
- `DisplayColumn` / `DisplayCard` / `DisplayEmpty` — typographic primitives sized
  for distance reading.

New routes: `display+/_layout.tsx`, `display+/_index.tsx`,
`display+/$workCenterId.maintenance.tsx`, `display+/$workCenterId.work.tsx`.

`path.to.displays`, `path.to.maintenanceDisplay(id)`, `path.to.workDisplay(id)`
added to `app/utils/path.ts`; a **Displays** link added to the MES sidebar's Tools
group.

## Acceptance Criteria

- [x] `/display` lists the active work centers at the current location with links to both displays
- [x] Maintenance display shows the seven-row scoreboard for one work center
- [x] Maintenance display goes red on unplanned downtime, planned downtime, an overdue dispatch, or an overdue schedule — and names the reason
- [x] Work display shows the running job(s), operators, elapsed time and quantity progress, plus the queue
- [x] Work display goes red when nothing is active, or when maintenance is blocking the work center
- [x] Both displays refresh unattended and are legible at distance
- [x] A work center from another company 404s
- [x] State derivation is unit tested (39 cases in `app/utils/display.test.ts`)
- [ ] Visual pass on real hardware at the intended mounting distance

## Reference

Modelled on a shop-floor display photographed at Boring (their "Wormhole" MES):
a bright header band carrying the machine name over a dark body of question/answer
rows — "Overdue PMs? NO / How Many? 0", "Semi-Annual Due Next 10 Days? YES / How
Many? 1", "Cost of Unplanned Maintenance Items, Last 90 Days? $0.00", "Last
Completed 7/28/26 By? JB" — with individual answer cells tinted by their own
severity. The adjacent screen showed the work display in its alert state: a
magenta header, "NONE" where the current job would be, and a table of queued
operations.

That reference is the floor. Deltas taken deliberately:

| Reference | Here | Why |
|-----------|------|-----|
| "Semi-Annual Due Next 10 Days?" | "Due in the next 10 days?" across all frequencies | Carbon's `maintenanceFrequency` has no Semi-Annual (Daily/Weekly/Monthly/Quarterly/Annual). Asking across every frequency is also strictly more useful. |
| Colour is the only signal for *why* | Header band names the reason ("Unplanned downtime · Maintenance overdue") | The reference makes you read all six rows to work out what went red. |
| No freshness indicator | Live clock + "Updated HH:MM:SS" + heartbeat dot | A wall display's worst failure is silent: the browser wedges and hours-old data looks live. |
| Timer only | Elapsed timer **and** idle timer when nothing is running | "Idle for 02:14:09" is the number a supervisor actually wants when the board is red. |
| Fixed layout | `clamp()` type scaling + tabular numerals | Same board reads correctly on a 24" tablet and a 75" TV; ticking digits don't reflow. |
| Current job only | Current job + operator + quantity progress bar | Progress against the operation quantity is free — it's already on `jobOperation`. |
