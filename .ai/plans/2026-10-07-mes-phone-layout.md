# MES phone layout — implementation plan

**Spec / source:** `.ai/specs/2026-10-07-mes-phone-layout.md`
**Status:** approved
**Branch:** `feat/mobile-redesign`

## Progress
- [x] Task 1: Schedule toolbar wraps on phones
- [x] Task 2: Board column width and card thumbnail tile
- [x] Task 3: Active and Recent card thumbnail tile
- [x] Task 4: Jobs list rows on phones
- [x] Task 5: Maintenance toolbar stacks on phones
- [x] Task 6: My Hours table scrolls inside its card on phones
- [x] Task 7: Picking detail header wraps
- [x] Task 8: Operation tabs on their own row
- [x] Task 9: Assembly and Inspection header strips scroll (no change: both already fit at 393px)
- [x] Task 10: Verify (typecheck, Biome, browser at 393px and 1280px)

## Dependencies
Tasks 1–9 are independent. Task 10 needs Tasks 1–9.

🛑 Never commit. Keep every element a screen shows. Use `max-md:` for style-only changes.

---

## Task 1: Schedule toolbar wraps on phones
**Files:** Modify `apps/mes/app/routes/x+/operations.tsx` (toolbar `HStack` under the header), and the same toolbar in `apps/mes/app/routes/x+/assigned.tsx`.
**Steps:**
1. Add `max-md:flex-wrap max-md:gap-2` to the outer toolbar `HStack` and the inner `HStack`.
2. Give the search `max-md:flex-1 max-md:min-w-0`.
**Verify:** At 393px on `/x/operations`, `document.documentElement.scrollWidth` is 393.

## Task 2: Board column width and card thumbnail tile
**Files:** Modify `apps/mes/app/components/Kanban/components/ColumnCard.tsx`, `apps/mes/app/components/Kanban/components/ItemCard.tsx`.
**Steps:**
1. Column: add `max-md:w-[300px]`.
2. Card: render the thumbnail a second time as a 40px tile (`hidden max-md:block size-10 shrink-0 rounded-md object-cover`) at the start of the header row. Give the large thumbnail wrapper `max-md:hidden`. Both obey `showThumbnail`.
**Verify:** At 393px a Schedule card is under 300px tall.

## Task 3: Active and Recent card thumbnail tile
**Files:** Modify `apps/mes/app/components/OperationsList.tsx`.
**Steps:** Apply the Task 2 thumbnail rule to the operation card.
**Verify:** At 393px on `/x/active`, two cards show in the first screen.

## Task 4: Jobs list rows on phones
**Files:** Modify `apps/mes/app/routes/x+/jobs.tsx`.
**Steps:**
1. Wrap the table in `max-md:hidden`.
2. Add a `hidden max-md:block` list. Each row is a `Link` to the job with the same 8 fields the table cells render, reusing the same cell content (status, deadline, `DateTime`, `EmployeeAvatar`).
**Verify:** At 393px every field shows; at 1280px the table is unchanged.

## Task 5: Maintenance toolbar stacks on phones
**Files:** Modify `apps/mes/app/routes/x+/maintenance.tsx`.
**Steps:** On the tabs/search `HStack` add `max-md:flex-col max-md:items-stretch`. Give the `TabsList` `max-md:w-full max-md:justify-start max-md:overflow-x-auto scrollbar-hide`.
**Verify:** At 393px no horizontal page scroll.

## Task 6: My Hours rows on phones
**Files:** Modify `apps/mes/app/routes/x+/timecard.tsx`.
**Steps:** Wrap `TableBase` in `max-md:overflow-x-auto max-md:-mx-6 max-md:px-6` and give it `max-md:min-w-[560px]`. The in-place row editor stays as it is.
**Verify:** At 393px no horizontal page scroll.

## Task 7: Picking detail header wraps
**Files:** Modify `apps/mes/app/routes/x+/picking.$pickingListId.tsx`.
**Steps:** Let the header row wrap on phones (`max-md:flex-wrap max-md:h-auto max-md:py-2`).
**Verify:** At 393px Finish is fully visible.

## Task 8: Operation tabs on their own row
**Files:** Modify `apps/mes/app/components/JobOperation/JobOperation.tsx` (header, about line 799).
**Steps:** On phones let the header wrap: the `TabsList` takes `max-md:order-last max-md:w-full max-md:ml-0 max-md:overflow-x-auto`, and the header becomes `max-md:h-auto max-md:flex-wrap max-md:py-1`.
**Verify:** At 393px all four tabs are visible or reachable by sideways scroll.

## Task 9: Assembly and Inspection header strips scroll
**Files:** Modify `apps/mes/app/components/AssemblyView.tsx`, `apps/mes/app/components/Inspection/InspectionView.tsx` (header strips).
**Steps:** Give the header control group `max-md:overflow-x-auto scrollbar-hide` and its children `shrink-0`.
**Verify:** At 393px no control is clipped; the strip scrolls.

## Task 10: Verify
1. `pnpm exec turbo run typecheck --filter=mes` — expected: success.
2. `pnpm exec biome check` on the changed files — expected: no errors.
3. Browser at 393px: re-take the screenshots of the changed screens and check `scrollWidth`.
4. Browser at 1280px: Schedule, Jobs, Operation look as before.
