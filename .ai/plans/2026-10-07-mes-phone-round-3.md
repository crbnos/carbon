# MES phone layout, round 3 — implementation plan

**Spec / source:** `.ai/specs/2026-10-07-mes-phone-round-2.md` (round 3 fixes its review findings)
**Status:** approved
**Evidence:** round-2 reviews in the session scratch `mes-r2/` (`review-layout.md` 65, `review-nav.md` 74, `review-operator.md` 66, `ac-report.md`)
**Branch:** `feat/mobile-redesign`

🛑 Never commit. Adapt, never add. Keep green Start and red Pause. Phone-only changes use `max-md:` or `useViewport().isPhone`.

## Decisions taken without the owner (the owner asked for no check-ins)

| Finding | Decision | Why |
|---|---|---|
| Inspection: move Reject and Partial into ⋯ (layout P1-1) | Not done. The 3 buttons share 1 row (`flex-1`) | Spec 3.1.4 was owner-approved; 1 row fixes the height without moving actions |
| My Hours: Clock In in flow, no fixed bar (nav P1-7) | Not done. Fixed bar kept; recorded as an exception to R13.2 | Spec 1.7.2 was owner-approved |
| Finish returns to the origin, also on desktop (nav P1-1 step 3) | Done | It extends the owner-approved Back-to-origin change; flagged in the report |
| Lift a shared `AppBar` into `@carbon/react` (nav P2-10) | Deferred to a later round | A refactor, not a phone fault |
| Where extra timers go with 3 work types (nav P1-2 step 4) | Deferred | Needs an owner answer |

## Progress

### Owner: agent A — Operation and job graph (`JobOperation.tsx`, `Controls.tsx`, `packages/react/src/BarProgress.tsx`, `JobDag.tsx`, `job.$jobId.tsx`)
- [x] A1: Below 768px render the `Times` meters as the first block of the Details scroll content, after the context row; hide the `[grid-area:status]` copy with `max-md:hidden` (layout P0-2.2, nav P1-6)
- [x] A2: Below 768px show the running label as the caption under the Pause button, not as its own row (layout P0-2.1)
- [x] A3: Tab row `max-md:py-0`; tabs stay 44px (layout P0-2.3)
- [x] A4: Facts row wraps on phones: `max-md:flex-wrap max-md:overflow-visible max-md:gap-y-1` (layout P1-2)
- [x] A5: Move the job ⋮ menu into the `MesAppBar` actions on phones; the context-row copy is `md:` only (nav P2-8). Its label is already `t\`More options\``
- [x] A6: Materials: trailing control in a fixed `w-28 justify-end` slot; list full-bleed on phones (layout P2)
- [x] A7: Due Date row on 1 line on phones ("Sep 30, 2026 · Due last week") (layout P2)
- [x] A8: Job graph on phones: dagre `nodesep: 24`, `ranksep: 56`; the toolbar floats bottom-right (`max-md:absolute max-md:bottom-4 max-md:right-4`) (layout P0-3). `minZoom: 0.6` on fit is already in
- [x] A9: Operation dock carries `data-mes-bottom-bar` and `--mes-bottom-bar-h: 91px` (`Controls.tsx`) for the toast rule (B5)
### Owner: agent B — Inspection, Assembly, origin, toasts, nav sheet
- [x] B1: Inspection action bar is 1 row: 3 buttons `flex-1` instead of `min-w-[calc(50%-0.25rem)]` (`InspectionView.tsx` ~`:924`)
- [x] B2: Inspection timer `aria-label` through Lingui (`:1460`); Characteristic `th`/`td` `max-md:max-w-[150px]`, gauge picker `w-full min-w-0` (`InspectionMeasurementMatrix.tsx`); meta bar wraps on phones `max-md:h-auto max-md:flex-wrap max-md:py-1.5`
- [x] B3: Assembly: Lingui for "Complete", "Done", "More actions" and the timer labels; below 768px Complete moves to a bottom action bar like Inspection's Accept; phone title is the job ID, item ID in the subtitle (nav P1-3)
- [x] B4: Origin through actions: hidden `from` in `QuantityModal`; `complete.tsx` and `finish.tsx` redirect to the origin (nav P1-1)
- [x] B5: Toasts above every bottom bar: `data-mes-bottom-bar` + `--mes-bottom-bar-h` on the Picking footer, Inspection bar, Operation dock (attribute only — agent A owns that file, so B adds the attribute through a wrapper prop if needed, or reports it), My Hours bar; extend the toast rule in `apps/mes/app/styles/tailwind.css` (nav P1-4)
- [x] B6: Nav sheet: `scroll-fade` on the scroller, title `max-md:text-[17px] max-md:font-semibold`, remove the dead `w-[17rem] max-w-[85vw]` (`NavRail.tsx`); close the sheet when its current row is tapped (nav P1-5, P2-11, P2-15)
- [x] B7: `useOrigin` labels a job-graph origin "Job" (new Lingui string) (nav P2-12); More tab gets `aria-haspopup="dialog"` and `aria-expanded` (`TabBar.tsx`, `MesTabBar.tsx`) (nav P2-14); Console pill below the app bar on phones (nav P2-16)
### Owner: main session — cards, toolbars, list pages
- [x] M1: Schedule lone column full width: phone board is a plain snap scroller, card `max-md:max-w-none` (operator P0-1, layout P0-1)
- [x] M2: Lone-column cards align to the 16px gutter (`group/column`, `max-md:group-only/column:px-4`)
- [x] M3: Work cards: no band seam (`CardHeader max-md:pb-1`, `CardContent max-md:border-t-0 max-md:pt-1`); short duration on phones (layout P1-4)
- [x] M4: Toolbar spacing `max-md:pt-3` on Schedule and Assigned (layout P1-5)
- [x] M5: Jobs rows in 3 lines: tracking and avatar on line 1 (layout P1-6)
- [x] M6: Picking detail: status in the app bar subtitle; name `md:truncate` so 2 lines show on phones; lines full-bleed (layout P1-7)
- [x] M7: Picking phone Finish is `primary` and 48px (operator P2-1, P2-3)
- [x] M8: My Hours: card title hidden on phones; Clock In 48px (operator P2-3, P2-4). Also hide the card header when nothing is clocked in (layout P1-8)
- [x] M9: Dispatch: the Description card was blank on every width because `generateHTML` returns "" on the server and hydration keeps that markup; it now renders client-only; fold "Time Worked" into the body; Add and remove-part buttons `lg` (layout P1-3, operator P2-2)
- [x] M10: Maintenance tabs bleed to the edge; avatar name `text-xs` (layout P2)
- [x] M11: Operation: Completed value `text-2xl font-semibold`, per-piece time muted on phones, Issue labelled, quantity foreground, job ⋮ 44px and ID once, larger running label, captions and dot (operator P1-2…P1-5)
- [x] M12: Inspection status badge in the meta bar on phones; timer caption 12px (operator P1-6)
- [x] M13: Job graph fit no smaller than 0.6 on phones (operator P1-7)

### Verify (main session)
- [x] V1: `pnpm exec turbo run typecheck --filter=mes --filter=erp --filter=@carbon/react`; Biome on changed files; `pnpm lingui:extract && pnpm lingui:clean`
- [x] V2: Browser at 393×852: AC 7 passes (card bottoms 458 and 766, tab bar at 798), overflow 393 on all screens, the round-2 screenshot set re-taken into `mes-r3/`
- [x] V3: Browser at 1280×800: Schedule, Jobs, Operation, Picking, Inspection unchanged except the desktop Finish destination
- [ ] V4: Round-3 review by 3 read-only reviewers (layout, navigation, operator); repeat rounds until each scores ≥ 75

## Run notes

- Inspection phone bar: with 3 buttons in 1 row, "Complete passed N" truncated to "C". It now takes its own full-width row only when passed units wait (`--mes-bottom-bar-h` 121px); otherwise the bar is 1 row.
- Dispatch Description was blank at every width: `generateHTML` returns "" during SSR and hydration keeps it. Both rich-text blocks now render client-only.
