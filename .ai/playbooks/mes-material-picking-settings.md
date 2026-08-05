# MES Material-Picking Settings (Part 1 + Part 2)

Last tested: 2026-07-29
Routes: ERP `/x/settings/production`, ERP `/x/settings/inventory`

## Prerequisites
- Migrations applied + `pnpm run generate:types` (adds
  `companySettings.autoSelectMaterialWithoutPickingList`,
  `companySettings.incompletePickingListPolicy`, and the `Partial`
  `pickingListStatus` enum value).

## Steps

### Part 1 — Production settings: pre-select toggle
1. Navigate `/x/settings/production`.
2. Card "Pre-select material without a picking list" holds a bare `<Switch>`
   (no aria-label). It is the **2nd** switch on the page (1st = "Auto-start
   timer on open"). Grab it via `document.querySelectorAll('[role=switch]')[1]`.
3. Click it → toast "Material pre-selection enabled" / "…disabled";
   `aria-checked` flips. Persists across reload (loader reads the column).

### Part 2 — Inventory settings: incomplete-pick policy
1. Navigate `/x/settings/inventory`.
2. Card "Finishing an incomplete pick" → a `ChoiceSelect` (the **3rd** combobox
   on the page, immediately before the 3rd "Save" button). Options:
   "Warn but allow" (`warn`, default) / "Block with an error" (`error`).
3. Click the combobox → click the desired option → the hidden input
   `input[name=incompletePickingListPolicy]` updates to `warn`/`error`.
4. Submit the **3rd** `Save` form via `requestSubmit` (not a click) →
   toast "Picking list completion policy updated". Persists across reload.

## Selector Notes
- Both controls lack accessible labels on the interactive element itself
  (label text lives in the sibling CardHeader), so target by position:
  2nd `[role=switch]` (Part 1), 3rd `combobox` / 3rd `Save` (Part 2).
- The hidden `input[name=incompletePickingListPolicy]` is the source of truth
  for the submitted value — verify it before submitting.

## Downstream behavior (verified via DB trigger, not browser — see below)
- `update_picking_list_status()` trigger: all lines resolved + any Short →
  header `Partial`; fully picked → `Completed`; unpick from a terminal state →
  `In Progress` (never stuck). Enum accepts `Partial`.
- The MES Finish flow (`/x/picking/:id` → status action) enforces the policy
  server-side (error blocks; warn → acknowledge modal → Partial). NOT yet
  browser-tested — requires a generated picking list (empty dev DB has none).

## Common Failures
- Switch/combobox "click does nothing" — ref shifted between `snapshot -i`
  calls; re-snapshot and grab a fresh ref, or target by DOM position.
