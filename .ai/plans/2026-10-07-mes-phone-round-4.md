# MES phone layout, round 4 — implementation plan

**Spec / source:** `.ai/specs/2026-10-07-mes-phone-round-2.md`; round 3 is `.ai/plans/2026-10-07-mes-phone-round-3.md`
**Status:** approved
**Evidence:** round-3 reviews in the session scratch `mes-r3/`: `review-layout.md` 75, `review-nav.md` 78, `review-operator.md` 73
**Branch:** `feat/mobile-redesign`

🛑 Never commit. Adapt, never add. Keep green Start and red Pause. Phone-only changes use `max-md:` or `useViewport().isPhone`. Desktop does not change.

## Decisions taken without the owner

| Finding | Decision | Why |
|---|---|---|
| `ModalTitle` 17/600 on phones (nav P2-8) | Deferred | It changes every ERP phone sheet too; a shared-component change for a later round |
| App bar title as `h1` + tap-to-top (nav P2-9) | Deferred with the shared `AppBar` lift | One change, in one place |
| Picking status pill in the app bar subtitle (nav regression 1) | Move it to the kit card header row | The subtitle names the parent page (R2.3); status belongs in content (R18.2) |

## Progress

### Agent A — Operation dock and Assembly (`JobOperation.tsx`, `Controls.tsx`, `useOperation.tsx`, `components/JobOperation/components/Parameter.tsx`, `AssemblyView.tsx`)
- [x] A1: Dock caption on phones shows the type and the time on 2 lines ("● Machine" / "2d, 9h"); the caption timer and the toggle use the same pick order, so Pause shows the selected timer's time; update the phone bar height variable (operator P0, spec AC 8)
- [x] A2: Lingui on the Setup/Labor/Machine toggle `aria-label`s and on "Issue Material" (operator P2)
- [x] A3: Process Parameters rows on phones: `max-md:px-4 max-md:py-3`, no fixed key width, long value under its label, IDs on 1 line (layout 2)
- [x] A4: Assembly bar: ⋮ and the timer at least 44px (`max-md:min-w-11`); the timer shows its elapsed time and work type on phones; steps bar `px-4`; tabs 44px underline style like Operation; progress row into the Details scroll content on phones; subtitle is `origin.label` only, item ID in the content (operator 2, layout 4, nav 3, P2-14, P2-15)

### Agent B — Inspection, origin, nav sheet (`InspectionView.tsx`, `InspectionMeasurementMatrix.tsx`, `routes/x+/inspection-lot.$id.complete-passed.tsx`, `routes/x+/inspection-lot.$id.disposition.tsx`, `NavRail.tsx`, `ConsolePill.tsx`, `routes/x+/picking.$pickingListId.tsx`)
- [x] B1: Inspection: below md the meta bar scrolls with the matrix (not fixed); the timer sits before ⋮ (layout 1, nav 2)
- [x] B2: Inspection gauge picker uses the full cell width on phones, no "Select g…" truncation (layout 1)
- [x] B3: Inspection actions keep the origin: hidden `from` on Complete passed and the disposition forms; their actions redirect with `withOrigin` / to the origin (nav 1). Open: `DispositionModal.tsx` (Reject, Partial) still needs `<Hidden name="from">`; the action already reads it
- [x] B4: Navigation sheet: make the bottom fade visible (static fade if `scroll-fade` does not show); title `max-md:px-4` (nav 4)
- [x] B5: Console pill on phones: bottom-left above the tab bar or page bar, `max-md:top-auto max-md:bottom-[calc(var(--mes-bottom-bar-h,54px)+env(safe-area-inset-bottom)+8px)]` (nav regression 3)
- [x] B6: Picking detail: subtitle back to "Picking"; the status pill moves into the kit card header row (nav regression 1)

### Main session — Schedule, cards, dispatch
- [x] M1: Schedule toolbar `max-md:space-x-0` on both toolbar `HStack`s (layout 3)
- [x] M2: Card customer and assignee names truncate (`min-w-0` + `truncate`) in `ItemCard.tsx` and `EmployeeAvatar.tsx` (layout 3)
- [x] M3: Multi-column phone board: `px-4 scroll-px-4` on the `BoardContainer` row (layout 5)
- [x] M4: Work-card quantity gets a muted phone-only caption with the existing "Quantity" string (operator 3)
- [x] M5: Dispatch Complete `max-md:h-12` (operator 4)

### Verify (main session)
- [x] V1: Typecheck `mes`, `erp`, `@carbon/react`; Biome; `pnpm lingui:extract && pnpm lingui:clean`
- [x] V2: Browser 393×852: re-shoot into `mes-r4/`; AC 7 and AC 8; overflow 393
- [x] V3: Browser 1280×800: Schedule, Operation, Inspection, Picking, Dispatch unchanged
- [x] V4: Round-4 reviews (3 lenses); stop when each is ≥ 75

## Run notes

- Reject and Partial post through `DispositionModal.tsx`; the main session added the hidden `from` there (agent B's gap).
- AC 7: card bottoms 458 and 766, tab bar 798. AC 8: the dock reads "Machine · 2d, 10h".
- Desktop change from A1: with 2 timers running, the dock caption shows the selected timer, not always Labor.
- Round-4 reviews: layout 78, navigation 80, operator 77. All 3 are at or above 75, so the review loop stops here.
- Owner report after round 4: on phones every drawer slid in from its desktop side while laid out as a bottom sheet. `Drawer.tsx` now overrides the slide variables below md (`data-[state]` variants, so they outrank `animate-in`); every phone drawer enters from the bottom. Verified: x 0, y 100% mid-animation.

## Backlog (round-4 reviews, not done)

- Kanban-scan completion drops the origin (`end.$operationId.tsx`).
- Timer `aria-label`s name the work type; Assembly timers before ⋮ without dividers.
- Assembly Record/Skip into the phone bottom bar; 44px filter and pager; Lingui on its plain strings; tab roles.
- Operation dock 8px lighter; 8px gap between the Setup/Labor/Machine toggles.
- Inspection full characteristic names; Dispatch status into the Work Center card; Picking kit header alignment; Jobs quantity label; job-graph legend 44px.
