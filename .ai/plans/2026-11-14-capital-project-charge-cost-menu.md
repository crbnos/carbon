# Charge cost on a capital project: disable it with the posting's reason

Bug: the element page offers Charge cost on an element whose treatment is
Capitalize. The ⋯ menu and the Actual tab's Charge menu offer it. Then
`postProjectExpense` refuses the entry: "An expense entry cannot charge a
capital project. Use a charge or a purchase invoice." `canChargeCost` in
`ElementView.tsx` checks only that the element is chargeable, the project is
open and the user may update projects.

Decision (taken before this plan): disable Charge cost, with the refusal as the
tooltip, when the treatment on today's date is Capitalize. Use the posting's
rule, not a copy. Keep the posting's refusal. Do not build an expense entry that
posts to construction in progress.

## Tasks

- [x] Add `projectExpenseRefusal(ctx, entryDate)` to `project-posting.ts`. It
  returns the refusal when `resolveProjectTreatment` gives Capitalize on the
  date, else null.
- [x] Make `postProjectExpense` refuse through `projectExpenseRefusal`. A
  reversal still skips the check.
- [x] Add `chargeCostRefusal` to `getProjectElementPage`:
  1. Load the element's context with `loadProjectPostingContexts`, the loader
     the posting uses.
  2. Call `projectExpenseRefusal` for today in the company time zone.
  3. Return null when the element has no row yet (a change request adds it) or
     the read fails. Log the failure.
- [x] `ElementView`: if the page has a `chargeCostRefusal` and the user may
  otherwise charge, disable Charge cost in the ⋯ menu. Show the reason as its
  tooltip. Copy the disabled item of `ServiceJobHeader` (Cancel Job).
- [x] `ElementTimeAndMaterials`: take `chargeDisabledReason` and show the same
  disabled item in the Actual tab's Charge menu. Both menus render
  `ChargeCostMenuItem`, exported from that file.
- [x] `ElementPlanLines`: take `chargeDisabledReason` and show the plan card's
  Charge button disabled with the same tooltip (the Add line tooltip pattern
  in the same file). `canChargeCost` keeps its permission test unchanged;
  `chargeCostEnabled` adds the refusal.
- [x] Check the modal's date. Result: the date is free (no minimum or maximum).
  Only an element override has an effective date
  (`costTreatmentEffectiveFrom`), and no ERP screen or operation writes it. With
  such an override, a date other than today can have another treatment:
  1. If today is Capitalize, the menu is off. So the user cannot make a
     backdated entry before the override starts from the page. The API
     (`projects_createProjectExpense`) still posts it.
  2. If today is not Capitalize, a date in a Capitalize period reaches the
     posting. The posting refuses it, and the modal shows the refusal.
- [x] Tests: `projectExpenseRefusal` in
  `apps/erp/test/database/lib/project-posting.test.ts` (the three other
  treatments, Capitalize, an ancestor's dated override, an element that
  expenses under a Capitalize project). `getChargeCostRefusal` and the
  posting's refusal in
  `apps/erp/test/database/post-project-expense/post-project-expense.test.ts`
  (a Capitalize project refuses and writes nothing; an element's own dated
  Capitalize override decides by date).
- [x] Sync: `.claude/rules/projects-system.md`, projects `AGENTS.md`,
  `docs/content/docs/reference/projects.mdx`.
- [x] Verify: erp typecheck, the scoped tests, Biome, `pnpm check:manifest`.
