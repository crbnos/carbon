# MES Assembly — Setup vs Labor clocking

Date: 2026-07-24
Area: `apps/mes` assembly view (`apps/mes/app/components/AssemblyView.tsx`)

## Problem

On an operation that has **both** setup time and labor time, the assembly view
has no clear, single mechanism for clocking one vs the other, and the two clocks
can run **simultaneously**:

- The header timer button toggles whichever type is in `selectedWorkType`, which
  is only changed by clicking a sidebar `TimeRows` row.
- The step-record automation (`AssemblyView.tsx` ~944-1013) starts/stops a
  **hardcoded `"Labor"`** event, ignoring `selectedWorkType`.
- The shared `/x/event` route never ends one open type when another starts.

Result on a setup+labor op: opening (with auto-start) starts **Setup**; recording
the first step starts **Labor** on top of it → both run, Setup never stops.
"Only labor" works because everything then targets the one Labor clock.

## Design — one clock per type in the header, mutually exclusive

Render one self-contained timer button per available work type in the top-right
(Setup / Labor / [Machine]). Each shows its own elapsed + label + play/pause.

1. **Header buttons** — one `TimerControl` per available work type (fallback to a
   single Labor button when the op has no configured durations).
2. **Mutual exclusion** — starting one type ends any other open type for the
   operator on that operation (assembly-only, via an `exclusive` flag on the
   submit; the operation view's `WorkTypeToggle` is untouched). Ended events are
   posted (`post-production-event`) so cost still books.
3. **Auto-transition** — recording the first step starts Labor with `exclusive`,
   which ends any open Setup. All-steps-recorded ends Labor (unchanged).
4. **Sidebar `TimeRows` → display-only** — the Setup/Labor progress rows stay as a
   read-out; the green dot now means "this phase is currently running" (derived
   from open events), not "selected". Removes the confusing selected-vs-accrued
   mismatch.

## Changes

- `apps/mes/app/services/models.ts` — add optional `exclusive` to
  `productionEventValidator`.
- `apps/mes/app/routes/x+/event.tsx` — on `Start` with `exclusive`, end other-typed
  open events (op+employee) and post each before starting.
- `apps/mes/app/components/AssemblyView.tsx`
  - drop `selectedWorkType`/`openEventForType`; add `headerWorkTypes` +
    `openEventForWorkType(type)`.
  - header: map `headerWorkTypes` → `TimerControl`.
  - `TimerControl`: add hidden `exclusive=true`.
  - step automation first-step Labor start: add `exclusive=true`.
  - `AutoTimer`: start `headerWorkTypes[0]`, set `exclusive`.
  - `TimeRows`/`TimerRow`: display-only, dot = running.

## Verify

- `pnpm exec turbo run typecheck --filter=mes`
- Manual: setup+labor op → tapping Labor stops Setup and vice-versa; recording
  first step auto-switches Setup→Labor; never both running. Labor-only op behaves
  as before.
