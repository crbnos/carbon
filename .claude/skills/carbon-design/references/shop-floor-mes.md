# Shop floor (MES) — same language, different ergonomics

Read this for anything in `apps/mes/` or any screen an operator uses at a machine, terminal,
wall display, or on a tablet. Also read `.claude/rules/mes-job-operation-ui.md` for the
operation screen's structure.

## Who and why

Operators work standing, often gloved, often one-handed, on shared tablets and terminals with
barcode scanners that *type into the page*. Attention is on the machine; mistakes cost scrap
and time. So MES keeps Carbon's tokens, primitives, status colors, copy rules and Lingui — and
changes the ergonomics.

## What changes

| Dimension | ERP (desk) | MES (floor) |
|---|---|---|
| Control size | `sm`/`md` (24/32px buttons) | **`size="lg"` default** (44–48px); hero Start/Pause 56 → 96 → 128px |
| Text | `text-xs`/`text-sm` | `text-sm`/`text-base`; big numbers for counts |
| Navigation | module rail + sub-nav + breadcrumbs + ⌘K | touch `Sidebar` of **task queues** (Schedule, Assigned, Active, Jobs, Maintenance, Picking) with live counts; per-page sticky header with title or "‹ Back" |
| Detail tabs | routes | client `Tabs` (Details / Model / Instructions / Chat) |
| Actions | header strip, menus | **dock**: right column at `lg`, bottom bar below `lg` (safe-area padding); one color-coded primary; "More actions" sheet |
| Secondary actions | ⋯ menus, context menus | `BottomSheet` / FAB sheet of big round icon buttons |
| Hover-reveal | common | **none** — everything visible |
| Context menus / bulk | yes | **none** |
| Lists | feature-rich Table | cards in `grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))]`, simple tables with one search, Kanban |
| Keyboard | bare letters OK (`n`, `g`) | **no bare letters** — `alt+1..7`, space (start/stop), enter, arrows; yield Enter to scans |
| Input | typing | barcode wedge; scanning a Carbon URL navigates |
| Identity | per-user login | shared terminal "console mode": PIN-in, Switch Operator, idle lock |
| Toasts | bottom-right | bottom-left (dock lives bottom-right) |
| Overlays | Drawer, ModalDrawer, Modal | **Modal + BottomSheet only** |
| Money | yes | no — quantities and durations |
| Glossary help | `termId` | none |
| Breakpoints | desktop-first, `md`/`lg` | tablet-first, **`lg` pivot**, ~7× more responsive classes; `tall:` variant for tall screens |
| Wall displays | — | dark, `clamp()`/viewport-scaled type, no interaction, "last updated" stamp |

## Rules for MES screens

1. **One dominant action**, visible, big, color-coded by meaning (Start emerald, Pause red),
   with a 3D press (`border-b-4 active:translate-y-1`) — plus a `motion-reduce:` fallback.
2. **Confirmations** use the same `Modal` layout as ERP (Cancel secondary left, action right),
   both `size="lg"`, and show what will be affected (EndShift lists each operation).
3. **Plain human questions** are fine on the floor: "How many were actually picked?",
   "Forgot to Clock Out?" / "I'm Still Working".
4. **Operator words** over data-model words ("Instructions", not "Procedure").
5. **Numbers with context:** "12 of 40", time elapsed, due status with an icon.
6. **Cards show the fields an operator scans:** item ID + description, big quantity, job ID,
   status (icon + text), due; optional fields controlled by display settings.
7. Status colors come from the shared maps — don't keep a local MES color map.
7a. **Every operator action is touch-sized** — including the "secondary" ones living in a pill,
   an indicator, or a banner (e.g. "Mark Machine Up"): `size="lg"` or the dock's icon-button
   sizes, never `sm`. If it's time-critical, it belongs in the dock.
7b. **Sheet/list rows** (More Actions, reason pickers) use muted icons
   (`stroke-muted-foreground`); color only for the one action whose meaning is the color.
7c. **Tap-to-submit choices are the last step.** If a choice submits on tap, optional inputs
   (a note) must come *before* it or in a follow-up step — never below buttons that already
   submitted.
7d. **Operator actions never navigate the operator away** from the operation screen (no
   redirects to ERP-style lists); they toast and stay.
7e. Reason pickers and other short lists loaded on open follow the loading rules in
   `status-and-feedback.md` §6 (skeleton while loading, empty only when truly empty).
8. Translate aria-labels (MES has many English literals — don't add more).
9. Where MES and ERP share a concept, **share the component** (`OperationStatusIcon`,
   `KANBAN_CARD_SHELL`, `DateTime`); MES is converging on ERP's visual language.

## Exemplars

`apps/mes/app/components/JobOperation/JobOperation.tsx` (shell),
`apps/mes/app/components/JobOperation/components/Controls.tsx` (dock, hero buttons, FAB),
`apps/mes/app/components/OperationsList.tsx` (cards), `apps/mes/app/components/AppSidebar.tsx`,
`apps/mes/app/components/ShortPickModal.tsx`, `apps/mes/app/components/EndShift.tsx`,
`apps/mes/app/components/Display/DisplayFrame.tsx`, `apps/mes/app/shortcuts.ts`.
