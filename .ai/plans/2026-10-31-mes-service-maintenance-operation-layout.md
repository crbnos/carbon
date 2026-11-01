# MES service job and maintenance dispatch in the operation view's layout

Goal: the MES service job page (`x+/service.$jobId.tsx`) and maintenance
dispatch page (`x+/dispatch.$dispatchId.tsx`) look like the job operation
view (`components/JobOperation/JobOperation.tsx`). Layout only: no loader,
action, posting or data change.

Sibling: the job operation view. Its markup is copied, not imported;
`JobOperation.tsx` is not changed.

## Decisions (approved 2026-10-31)

- One shared shell in `apps/mes/app/components/WorkRecord.tsx`
  (`WorkRecordShell` and its parts): top bar (back link + tabs), context strip
  (id and info chips; no ⋮ menu, neither record has actions for it), one pane
  per tab, and the operation view's own dock (`Controls`, `PlayButton`,
  `PauseButton`, `IconButtonWithTooltip`). Phones keep `MesAppBar`; the dock
  becomes the bottom bar.
- Service tabs: Details · Notes (Findings, Resolution) · Photos.
- Maintenance tabs: Details · Procedure.
- Service stat cards: Today, Total time, Warranty.
- Maintenance stat cards: Time worked, Impact, Planned (the dispatch has a planned start and end, no due date).

## Tasks

- [x] Shell component with the operation view's classes
- [x] Service job page on the shell
- [x] Maintenance dispatch page on the shell
- [x] Biome + `turbo run typecheck --filter=mes`
- [x] Browser check, desktop and phone width, both pages
